import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiGatewayStackProps extends cdk.StackProps {
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
  buildStateTable: dynamodb.Table;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    // API Lambda handler
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: 'bedrock-builder-api',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os
from datetime import datetime
from uuid import uuid4

dynamodb = boto3.resource('dynamodb')
bedrock_agent = boto3.client('bedrock-agent-runtime')

table = dynamodb.Table(os.environ['BUILD_STATE_TABLE'])
agent_id = os.environ['BEDROCK_AGENT_ID']
agent_alias_id = os.environ['BEDROCK_AGENT_ALIAS_ID']

def lambda_handler(event, context):
    path = event.get('path', '')
    method = event.get('httpMethod', '')

    try:
        if path == '/build' and method == 'POST':
            return start_build(event)
        elif path.startswith('/build/') and method == 'GET':
            build_id = path.split('/')[-1]
            if build_id == 'list' or path == '/builds':
                return list_builds(event)
            elif '/logs' in path:
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

    # Invoke Bedrock Agent asynchronously
    # Note: In production, this would use SQS + Lambda or Step Functions
    # For now, placeholder for agent invocation

    return {
        'statusCode': 202,
        'body': json.dumps({
            'build_id': build_id,
            'status': 'initiated',
            'message': 'Build started'
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
    return {
        'statusCode': 501,
        'body': json.dumps({'message': 'Not implemented yet'})
    }

def cancel_build(event):
    return {
        'statusCode': 501,
        'body': json.dumps({'message': 'Not implemented yet'})
    }
`),
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUILD_STATE_TABLE: props.buildStateTable.tableName,
        BEDROCK_AGENT_ID: props.bedrockAgentId,
        BEDROCK_AGENT_ALIAS_ID: props.bedrockAgentAliasId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB permissions
    props.buildStateTable.grantReadWriteData(apiHandler);

    // Grant Bedrock Agent permissions
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeAgent',
      ],
      resources: ['*'],
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
