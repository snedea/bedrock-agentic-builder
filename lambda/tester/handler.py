"""Tester Agent Lambda handler - Runs tests and implements self-healing."""

import os
import json
import logging
import boto3
import time
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
ecs = boto3.client('ecs')


def lambda_handler(event, context):
    """Tester agent: Runs tests in Fargate and analyzes results."""
    try:
        logger.info(f'Tester agent invoked')

        if 'inputText' in event:
            input_data = json.loads(event['inputText'])
        else:
            input_data = event

        build_id = input_data['build_id']

        build = state_manager.get_build(build_id)
        iteration = build.get('current_iteration', 0)
        max_iterations = build.get('max_iterations', 3)

        state_manager.update_status(build_id, 'testing')

        # Run tests in ECS Fargate
        test_output = run_tests_in_fargate(build_id)

        # Analyze test results
        analysis = bedrock_client.analyze_test_results(test_output, iteration)

        tests_passed = analysis.get('tests_passed', False)

        if tests_passed:
            state_manager.update_status(build_id, 'passed')
            tester_output = {
                'tests_passed': True,
                'iteration': iteration,
                'message': 'All tests passed'
            }
        else:
            # Check if max iterations reached
            if iteration >= max_iterations:
                state_manager.update_status(build_id, 'failed')
                tester_output = {
                    'tests_passed': False,
                    'iteration': iteration,
                    'failures': analysis.get('failures', []),
                    'message': f'Tests failed after {max_iterations} iterations'
                }
            else:
                # Increment iteration for self-healing
                new_iteration = state_manager.increment_iteration(build_id)
                state_manager.update_status(build_id, 'self_healing')

                tester_output = {
                    'tests_passed': False,
                    'iteration': new_iteration,
                    'failures': analysis.get('failures', []),
                    'recommendations': analysis.get('recommendations', []),
                    'root_cause': analysis.get('root_cause', ''),
                    'message': f'Initiating self-healing (iteration {new_iteration})'
                }

        state_manager.save_agent_output(build_id, 'tester', tester_output)
        s3_manager.upload_log(build_id, f'test-iteration-{iteration}', test_output)

        logger.info(f'Testing complete for build {build_id}: {"PASSED" if tests_passed else "FAILED"}')

        return {'statusCode': 200, 'body': json.dumps(tester_output)}

    except Exception as e:
        logger.error(f'Tester error: {str(e)}', exc_info=True)
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}


def run_tests_in_fargate(build_id: str) -> str:
    """Execute tests in ECS Fargate task."""
    cluster = os.environ['ECS_CLUSTER']
    task_def = os.environ['TASK_DEFINITION']

    logger.info(f'Starting ECS task for build {build_id}')

    # Run task
    response = ecs.run_task(
        cluster=cluster,
        taskDefinition=task_def,
        launchType='FARGATE',
        networkConfiguration={
            'awsvpcConfiguration': {
                'assignPublicIp': 'ENABLED',
                'subnets': ['subnet-xxx'],  # Use default VPC subnets
            }
        },
        overrides={
            'containerOverrides': [{
                'name': 'code-executor',
                'environment': [
                    {'name': 'BUILD_ID', 'value': build_id},
                ]
            }]
        }
    )

    task_arn = response['tasks'][0]['taskArn']
    logger.info(f'Task started: {task_arn}')

    # Wait for task to complete (with timeout)
    waiter = ecs.get_waiter('tasks_stopped')
    waiter.wait(
        cluster=cluster,
        tasks=[task_arn],
        WaiterConfig={'Delay': 10, 'MaxAttempts': 60}  # 10 minutes max
    )

    # Get test results from S3
    test_output = s3_manager.download_log(build_id, 'test-output')

    return test_output if test_output else 'No test output found'
