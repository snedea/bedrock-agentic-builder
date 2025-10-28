import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface BedrockAgentStackProps extends cdk.StackProps {
  buildStateTable: dynamodb.Table;
  artifactsBucket: s3.Bucket;
  logsBucket: s3.Bucket;
  kbBucket: s3.Bucket;
  ecsCluster: ecs.Cluster;
  codeExecutorTaskDefinition: ecs.FargateTaskDefinition;
}

export class BedrockAgentStack extends cdk.Stack {
  public readonly scoutFunction: lambda.Function;
  public readonly architectFunction: lambda.Function;
  public readonly builderFunction: lambda.Function;
  public readonly testerFunction: lambda.Function;
  public readonly agentId: string;
  public readonly agentAliasId: string;

  constructor(scope: Construct, id: string, props: BedrockAgentStackProps) {
    super(scope, id, props);

    // Shared Lambda layer for common dependencies
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/shared')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Shared libraries for Bedrock builder Lambda functions',
    });

    // Common environment variables
    const commonEnv = {
      BUILD_STATE_TABLE: props.buildStateTable.tableName,
      ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
      LOGS_BUCKET: props.logsBucket.bucketName,
      KB_BUCKET: props.kbBucket.bucketName,
      ECS_CLUSTER: props.ecsCluster.clusterName,
      TASK_DEFINITION: props.codeExecutorTaskDefinition.taskDefinitionArn,
      AWS_REGION: this.region,
    };

    // Scout Lambda function
    this.scoutFunction = new lambda.Function(this, 'ScoutFunction', {
      functionName: 'bedrock-builder-scout',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/scout')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Architect Lambda function
    this.architectFunction = new lambda.Function(this, 'ArchitectFunction', {
      functionName: 'bedrock-builder-architect',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/architect')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Builder Lambda function
    this.builderFunction = new lambda.Function(this, 'BuilderFunction', {
      functionName: 'bedrock-builder-builder',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/builder')),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: commonEnv,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Tester Lambda function
    this.testerFunction = new lambda.Function(this, 'TesterFunction', {
      functionName: 'bedrock-builder-tester',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/tester')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: commonEnv,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB permissions to all functions
    const functions = [
      this.scoutFunction,
      this.architectFunction,
      this.builderFunction,
      this.testerFunction,
    ];

    functions.forEach((fn) => {
      props.buildStateTable.grantReadWriteData(fn);
      props.artifactsBucket.grantReadWrite(fn);
      props.logsBucket.grantReadWrite(fn);
      props.kbBucket.grantRead(fn);
    });

    // Grant Bedrock permissions
    functions.forEach((fn) => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
        ],
      }));
    });

    // Grant ECS permissions to Builder and Tester
    [this.builderFunction, this.testerFunction].forEach((fn) => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'ecs:RunTask',
          'ecs:DescribeTasks',
          'ecs:StopTask',
        ],
        resources: ['*'],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          props.codeExecutorTaskDefinition.taskRole.roleArn,
          props.codeExecutorTaskDefinition.executionRole!.roleArn,
        ],
      }));
    });

    // Bedrock Agent role
    const agentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    });

    // Grant agent permission to invoke Lambda functions
    functions.forEach((fn) => {
      fn.grantInvoke(agentRole);
    });

    // Grant agent access to Bedrock models
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
      ],
    }));

    // Placeholder for Bedrock Agent (created via AWS CLI/Console due to CDK L1 construct limitations)
    // The agent configuration is in bedrock/agent-config.json
    // Deployment script will create the agent using AWS CLI

    // For now, output the function ARNs for agent configuration
    this.agentId = 'PLACEHOLDER_AGENT_ID'; // Will be created by deployment script
    this.agentAliasId = 'PLACEHOLDER_ALIAS_ID';

    // Outputs
    new cdk.CfnOutput(this, 'ScoutFunctionArn', {
      value: this.scoutFunction.functionArn,
      description: 'Scout Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'ArchitectFunctionArn', {
      value: this.architectFunction.functionArn,
      description: 'Architect Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'BuilderFunctionArn', {
      value: this.builderFunction.functionArn,
      description: 'Builder Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'TesterFunctionArn', {
      value: this.testerFunction.functionArn,
      description: 'Tester Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'AgentRoleArn', {
      value: agentRole.roleArn,
      description: 'Bedrock Agent IAM role ARN',
    });
  }
}
