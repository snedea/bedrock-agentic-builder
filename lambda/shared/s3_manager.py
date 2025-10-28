"""S3 operations for artifacts and logs."""

import boto3
import json
from typing import Dict, Any, List
from pathlib import Path


class S3Manager:
    """Manages S3 operations for build artifacts and logs."""

    def __init__(self, artifacts_bucket: str, logs_bucket: str):
        self.s3 = boto3.client('s3')
        self.artifacts_bucket = artifacts_bucket
        self.logs_bucket = logs_bucket

    def upload_artifact(
        self,
        build_id: str,
        file_path: str,
        content: str
    ) -> str:
        """Upload a code artifact to S3."""
        key = f'{build_id}/{file_path}'

        self.s3.put_object(
            Bucket=self.artifacts_bucket,
            Key=key,
            Body=content.encode('utf-8'),
            ContentType='text/plain',
        )

        return f's3://{self.artifacts_bucket}/{key}'

    def download_artifact(self, build_id: str, file_path: str) -> str:
        """Download a code artifact from S3."""
        key = f'{build_id}/{file_path}'

        response = self.s3.get_object(
            Bucket=self.artifacts_bucket,
            Key=key,
        )

        return response['Body'].read().decode('utf-8')

    def list_artifacts(self, build_id: str) -> List[str]:
        """List all artifacts for a build."""
        response = self.s3.list_objects_v2(
            Bucket=self.artifacts_bucket,
            Prefix=f'{build_id}/',
        )

        return [
            obj['Key'].replace(f'{build_id}/', '', 1)
            for obj in response.get('Contents', [])
        ]

    def upload_log(
        self,
        build_id: str,
        log_type: str,
        content: str
    ) -> str:
        """Upload a build log to S3."""
        key = f'{build_id}/{log_type}.log'

        self.s3.put_object(
            Bucket=self.logs_bucket,
            Key=key,
            Body=content.encode('utf-8'),
            ContentType='text/plain',
        )

        return f's3://{self.logs_bucket}/{key}'

    def download_log(self, build_id: str, log_type: str) -> str:
        """Download a build log from S3."""
        key = f'{build_id}/{log_type}.log'

        try:
            response = self.s3.get_object(
                Bucket=self.logs_bucket,
                Key=key,
            )
            return response['Body'].read().decode('utf-8')
        except self.s3.exceptions.NoSuchKey:
            return ''

    def upload_json(
        self,
        build_id: str,
        file_name: str,
        data: Dict[str, Any]
    ) -> str:
        """Upload JSON data to artifacts bucket."""
        key = f'{build_id}/{file_name}'

        self.s3.put_object(
            Bucket=self.artifacts_bucket,
            Key=key,
            Body=json.dumps(data, indent=2),
            ContentType='application/json',
        )

        return f's3://{self.artifacts_bucket}/{key}'

    def download_json(self, build_id: str, file_name: str) -> Dict[str, Any]:
        """Download JSON data from artifacts bucket."""
        key = f'{build_id}/{file_name}'

        response = self.s3.get_object(
            Bucket=self.artifacts_bucket,
            Key=key,
        )

        return json.loads(response['Body'].read().decode('utf-8'))

    def get_artifact_url(self, build_id: str, file_path: str) -> str:
        """Generate presigned URL for artifact download."""
        key = f'{build_id}/{file_path}'

        return self.s3.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': self.artifacts_bucket,
                'Key': key,
            },
            ExpiresIn=3600,  # 1 hour
        )
