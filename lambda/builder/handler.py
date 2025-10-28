"""Builder Agent Lambda handler - Generates code and stores in S3."""

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
    """Builder agent: Generates code and uploads to S3."""
    try:
        logger.info(f'Builder agent invoked')

        if 'inputText' in event:
            input_data = json.loads(event['inputText'])
        else:
            input_data = event

        build_id = input_data['build_id']

        # Get Architect output
        build = state_manager.get_build(build_id)
        architect_output = build.get('architect_output', {})

        state_manager.update_status(build_id, 'building')

        # Generate code for each file
        file_structure = architect_output.get('file_structure', {})
        files_created = []

        for file_path, spec in file_structure.items():
            logger.info(f'Generating code for {file_path}')

            # Determine language from file extension
            ext = file_path.split('.')[-1]
            language_map = {
                'py': 'python',
                'js': 'javascript',
                'ts': 'typescript',
                'go': 'go',
                'rs': 'rust'
            }
            language = language_map.get(ext, 'python')

            # Generate code
            code = bedrock_client.generate_code(file_path, str(spec), language)

            # Upload to S3
            s3_manager.upload_artifact(build_id, file_path, code)
            files_created.append(file_path)

        builder_output = {
            'files_created': files_created,
            'status': 'success'
        }

        state_manager.save_agent_output(build_id, 'builder', builder_output)

        logger.info(f'Build complete: {len(files_created)} files created')

        return {'statusCode': 200, 'body': json.dumps(builder_output)}

    except Exception as e:
        logger.error(f'Builder error: {str(e)}', exc_info=True)
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}
