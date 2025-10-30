import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiGatewayStackProps extends cdk.StackProps {
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
  buildStateTable: dynamodb.Table;
  stateMachine: sfn.StateMachine;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    // API Lambda handler
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: 'bedrock-builder-api',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os
from datetime import datetime
from uuid import uuid4

dynamodb = boto3.resource('dynamodb')
sfn = boto3.client('stepfunctions')

table = dynamodb.Table(os.environ['BUILD_STATE_TABLE'])
state_machine_arn = os.environ['STATE_MACHINE_ARN']

def lambda_handler(event, context):
    path = event.get('path', '')
    method = event.get('httpMethod', '')

    try:
        if path == '/builds' and method == 'GET':
            return list_builds(event)
        elif path == '/build' and method == 'POST':
            return start_build(event)
        elif path.startswith('/build/') and method == 'GET':
            build_id = path.split('/')[-1]
            if '/logs' in path:
                return get_build_logs(event)
            else:
                return get_build_status(build_id)
        elif path.startswith('/build/') and method == 'POST' and '/cancel' in path:
            return cancel_build(event)
        else:
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'Not found'})
            }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def start_build(event):
    body = json.loads(event.get('body', '{}'))
    task = body.get('task')
    mode = body.get('mode', 'new_project')
    max_iterations = body.get('max_iterations', 3)

    if not task:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'task is required'})
        }

    build_id = str(uuid4())
    timestamp = datetime.utcnow().isoformat()

    # Create build record
    table.put_item(Item={
        'build_id': build_id,
        'task': task,
        'mode': mode,
        'status': 'initiated',
        'current_iteration': 0,
        'max_iterations': max_iterations,
        'created_at': timestamp,
        'updated_at': timestamp,
    })

    # Start Step Functions execution for parallel build workflow
    try:
        execution_input = {
            'build_id': build_id,
            'task': task,
            'mode': mode,
            'max_iterations': max_iterations
        }

        response = sfn.start_execution(
            stateMachineArn=state_machine_arn,
            name=build_id,  # Use build_id as execution name
            input=json.dumps(execution_input)
        )

        print(f'Step Functions execution started for build {build_id}')
        print(f'Execution ARN: {response["executionArn"]}')

        return {
            'statusCode': 202,
            'body': json.dumps({
                'build_id': build_id,
                'execution_arn': response['executionArn'],
                'status': 'initiated',
                'message': 'Build started with parallel execution'
            })
        }

    except Exception as e:
        error_msg = f'Error starting Step Functions execution: {str(e)}'
        print(error_msg)

        # Update build status to failed
        table.update_item(
            Key={'build_id': build_id},
            UpdateExpression='SET #status = :status, error = :error',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'failed',
                ':error': error_msg
            }
        )

        return {
            'statusCode': 500,
            'body': json.dumps({
                'build_id': build_id,
                'status': 'failed',
                'error': error_msg
            })
        }

def get_build_status(build_id):
    response = table.get_item(Key={'build_id': build_id})
    item = response.get('Item')

    if not item:
        return {
            'statusCode': 404,
            'body': json.dumps({'error': 'Build not found'})
        }

    return {
        'statusCode': 200,
        'body': json.dumps(item, default=str)
    }

def list_builds(event):
    params = event.get('queryStringParameters') or {}
    status_filter = params.get('status')

    if status_filter:
        response = table.query(
            IndexName='status-index',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': status_filter},
            ScanIndexForward=False,
            Limit=50
        )
    else:
        response = table.scan(Limit=50)

    return {
        'statusCode': 200,
        'body': json.dumps({
            'builds': response.get('Items', []),
            'count': len(response.get('Items', []))
        }, default=str)
    }

def get_build_logs(event):
    path = event.get('path', '')
    build_id = path.split('/')[-2]  # Extract from /build/{id}/logs

    # Verify build exists
    response = table.get_item(Key={'build_id': build_id})
    if 'Item' not in response:
        return {
            'statusCode': 404,
            'body': json.dumps({'error': 'Build not found'})
        }

    # Retrieve logs from S3
    s3 = boto3.client('s3')
    logs_bucket = os.environ.get('LOGS_BUCKET')
    log_key = f'{build_id}/test-output.log'

    try:
        log_response = s3.get_object(Bucket=logs_bucket, Key=log_key)
        log_content = log_response['Body'].read().decode('utf-8')

        return {
            'statusCode': 200,
            'body': json.dumps({
                'build_id': build_id,
                'logs': log_content,
                'log_size': len(log_content)
            })
        }
    except s3.exceptions.NoSuchKey:
        return {
            'statusCode': 404,
            'body': json.dumps({
                'error': 'Logs not found',
                'message': 'Build has not yet generated test logs'
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f'Error retrieving logs: {str(e)}'})
        }

def cancel_build(event):
    path = event.get('path', '')
    build_id = path.split('/')[-2]  # Extract from /build/{id}/cancel

    # Verify build exists
    response = table.get_item(Key={'build_id': build_id})
    if 'Item' not in response:
        return {
            'statusCode': 404,
            'body': json.dumps({'error': 'Build not found'})
        }

    build = response['Item']
    current_status = build.get('status', 'unknown')

    # Check if build is already completed or cancelled
    if current_status in ['completed', 'cancelled', 'failed']:
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'Build cannot be cancelled',
                'message': f'Build is already in {current_status} state'
            })
        }

    # Stop Step Functions execution
    try:
        execution_arn = f'arn:aws:states:{os.environ.get("AWS_REGION", "us-east-1")}:{os.environ.get("AWS_ACCOUNT_ID")}:execution:bedrock-builder-workflow:{build_id}'

        sfn.stop_execution(
            executionArn=execution_arn,
            error='UserCancelled',
            cause='Build cancelled by user via API'
        )

        # Update build status in DynamoDB
        table.update_item(
            Key={'build_id': build_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'cancelled',
                ':updated_at': datetime.utcnow().isoformat()
            }
        )

        return {
            'statusCode': 200,
            'body': json.dumps({
                'build_id': build_id,
                'status': 'cancelled',
                'message': 'Build cancelled successfully'
            })
        }

    except sfn.exceptions.ExecutionDoesNotExist:
        # Execution may have already completed/failed
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'Cannot cancel build',
                'message': 'Step Functions execution not found or already completed'
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f'Error cancelling build: {str(e)}'})
        }
`),
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUILD_STATE_TABLE: props.buildStateTable.tableName,
        STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
        LOGS_BUCKET: `bedrock-builder-logs-${this.account}`,
        AWS_ACCOUNT_ID: this.account,
        // AWS_REGION is automatically set by Lambda runtime - don't set manually
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB permissions
    props.buildStateTable.grantReadWriteData(apiHandler);

    // Grant S3 read permissions for logs bucket
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::bedrock-builder-logs-${this.account}/*`],
    }));

    // Grant Step Functions execution permissions
    props.stateMachine.grantStartExecution(apiHandler);

    // Grant Step Functions stop execution permissions
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StopExecution'],
      resources: [props.stateMachine.stateMachineArn.replace(':stateMachine:', ':execution:') + ':*'],
    }));

    // REST API
    this.api = new apigateway.RestApi(this, 'BuilderApi', {
      restApiName: 'Bedrock Builder API',
      description: 'API for managing autonomous builds with Bedrock agents',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Lambda integration
    const integration = new apigateway.LambdaIntegration(apiHandler);

    // API resources and methods
    const build = this.api.root.addResource('build');
    build.addMethod('POST', integration); // POST /build

    const buildId = build.addResource('{id}');
    buildId.addMethod('GET', integration); // GET /build/{id}

    const logsResource = buildId.addResource('logs');
    logsResource.addMethod('GET', integration); // GET /build/{id}/logs

    const cancel = buildId.addResource('cancel');
    cancel.addMethod('POST', integration); // POST /build/{id}/cancel

    const builds = this.api.root.addResource('builds');
    builds.addMethod('GET', integration); // GET /builds

    // API Key for authentication
    const apiKey = this.api.addApiKey('BuilderApiKey', {
      apiKeyName: 'bedrock-builder-key',
    });

    const usagePlan = this.api.addUsagePlan('BuilderUsagePlan', {
      name: 'Standard',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 1000,
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID',
    });
  }
}
