"""Architect Agent Lambda handler - Designs system architecture."""

import os
import json
import logging
import sys
sys.path.insert(0, '/opt/python')

from state_manager import StateManager
from s3_manager import S3Manager
from bedrock_client import BedrockClient

logger = logging.getLogger()
logger.setLevel(logging.INFO)

state_manager = StateManager(os.environ['BUILD_STATE_TABLE'])
s3_manager = S3Manager(os.environ['ARTIFACTS_BUCKET'], os.environ['LOGS_BUCKET'])
bedrock_client = BedrockClient(os.environ['AWS_REGION'])


def lambda_handler(event, context):
    """Architect agent: Designs system architecture based on Scout findings."""
    try:
        logger.info(f'Architect agent invoked')

        if 'inputText' in event:
            input_data = json.loads(event['inputText'])
        else:
            input_data = event

        build_id = input_data['build_id']

        # Get Scout output
        build = state_manager.get_build(build_id)
        scout_output = build.get('scout_output', {})
        task = build['task']

        state_manager.update_status(build_id, 'architecting')

        # Design architecture
        architecture = bedrock_client.design_architecture(
            task,
            scout_output.get('requirements', [])
        )

        architect_output = {
            'file_structure': architecture.get('file_structure', {}),
            'modules': architecture.get('modules', []),
            'implementation_steps': architecture.get('implementation_steps', []),
        }

        state_manager.save_agent_output(build_id, 'architect', architect_output)
        s3_manager.upload_json(build_id, 'architecture.json', architect_output)

        logger.info(f'Architecture design complete for build {build_id}')

        return {'statusCode': 200, 'body': json.dumps(architect_output)}

    except Exception as e:
        logger.error(f'Architect error: {str(e)}', exc_info=True)
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}
