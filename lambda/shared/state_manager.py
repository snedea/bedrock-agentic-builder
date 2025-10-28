"""DynamoDB state management for builds."""

import boto3
from datetime import datetime
from typing import Dict, Any, Optional, List
from decimal import Decimal


class StateManager:
    """Manages build state in DynamoDB."""

    def __init__(self, table_name: str):
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(table_name)

    def create_build(
        self,
        build_id: str,
        task: str,
        mode: str = 'new_project',
        max_iterations: int = 3
    ) -> Dict[str, Any]:
        """Create a new build record."""
        timestamp = datetime.utcnow().isoformat()

        item = {
            'build_id': build_id,
            'task': task,
            'mode': mode,
            'status': 'initiated',
            'current_iteration': 0,
            'max_iterations': max_iterations,
            'created_at': timestamp,
            'updated_at': timestamp,
        }

        self.table.put_item(Item=item)
        return item

    def update_status(self, build_id: str, status: str) -> None:
        """Update build status."""
        self.table.update_item(
            Key={'build_id': build_id},
            UpdateExpression='SET #status = :status, updated_at = :timestamp',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': status,
                ':timestamp': datetime.utcnow().isoformat(),
            },
        )

    def save_agent_output(
        self,
        build_id: str,
        agent: str,
        output: Dict[str, Any]
    ) -> None:
        """Save agent output to build record."""
        field_name = f'{agent}_output'

        self.table.update_item(
            Key={'build_id': build_id},
            UpdateExpression=f'SET {field_name} = :output, updated_at = :timestamp',
            ExpressionAttributeValues={
                ':output': output,
                ':timestamp': datetime.utcnow().isoformat(),
            },
        )

    def increment_iteration(self, build_id: str) -> int:
        """Increment iteration counter and return new value."""
        response = self.table.update_item(
            Key={'build_id': build_id},
            UpdateExpression='SET current_iteration = current_iteration + :inc, updated_at = :timestamp',
            ExpressionAttributeValues={
                ':inc': 1,
                ':timestamp': datetime.utcnow().isoformat(),
            },
            ReturnValues='UPDATED_NEW',
        )

        return int(response['Attributes']['current_iteration'])

    def get_build(self, build_id: str) -> Optional[Dict[str, Any]]:
        """Get build record by ID."""
        response = self.table.get_item(Key={'build_id': build_id})
        return self._deserialize_item(response.get('Item'))

    def list_builds(
        self,
        status_filter: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """List builds, optionally filtered by status."""
        if status_filter:
            response = self.table.query(
                IndexName='status-index',
                KeyConditionExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': status_filter},
                ScanIndexForward=False,
                Limit=limit,
            )
        else:
            response = self.table.scan(Limit=limit)

        return [self._deserialize_item(item) for item in response.get('Items', [])]

    def _deserialize_item(self, item: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Convert Decimal types to native Python types."""
        if not item:
            return None

        def convert_decimals(obj):
            if isinstance(obj, Decimal):
                return int(obj) if obj % 1 == 0 else float(obj)
            elif isinstance(obj, dict):
                return {k: convert_decimals(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimals(i) for i in obj]
            return obj

        return convert_decimals(item)
