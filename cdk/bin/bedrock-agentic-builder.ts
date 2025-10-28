#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { EcsStack } from '../lib/ecs-stack';
import { BedrockAgentStack } from '../lib/bedrock-agent-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Storage stack - DynamoDB and S3 buckets
const storageStack = new StorageStack(app, 'BedrockBuilderStorageStack', {
  env,
  description: 'Storage resources for Bedrock agentic builder (DynamoDB, S3)',
});

// ECS stack - Fargate cluster and task definitions
const ecsStack = new EcsStack(app, 'BedrockBuilderEcsStack', {
  env,
  description: 'ECS Fargate resources for code execution',
  artifactsBucket: storageStack.artifactsBucket,
  logsBucket: storageStack.logsBucket,
});

// Bedrock Agent stack - Agent and Lambda action groups
const bedrockStack = new BedrockAgentStack(app, 'BedrockBuilderAgentStack', {
  env,
  description: 'Bedrock Agent with Scout, Architect, Builder, Tester action groups',
  buildStateTable: storageStack.buildStateTable,
  artifactsBucket: storageStack.artifactsBucket,
  logsBucket: storageStack.logsBucket,
  kbBucket: storageStack.kbBucket,
  ecsCluster: ecsStack.cluster,
  codeExecutorTaskDefinition: ecsStack.codeExecutorTaskDefinition,
});

// API Gateway stack - REST API endpoints
const apiStack = new ApiGatewayStack(app, 'BedrockBuilderApiStack', {
  env,
  description: 'API Gateway REST API for build operations',
  bedrockAgentId: bedrockStack.agentId,
  bedrockAgentAliasId: bedrockStack.agentAliasId,
  buildStateTable: storageStack.buildStateTable,
});

// Monitoring stack - CloudWatch dashboards
const monitoringStack = new MonitoringStack(app, 'BedrockBuilderMonitoringStack', {
  env,
  description: 'CloudWatch dashboards and alarms',
  buildStateTable: storageStack.buildStateTable,
  scoutFunction: bedrockStack.scoutFunction,
  architectFunction: bedrockStack.architectFunction,
  builderFunction: bedrockStack.builderFunction,
  testerFunction: bedrockStack.testerFunction,
});

// Tags for all resources
cdk.Tags.of(app).add('Project', 'BedrockAgenticBuilder');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
