import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BedrockAgentStack } from '../lib/bedrock-agent-stack';
import { StorageStack } from '../lib/storage-stack';
import { EcsStack } from '../lib/ecs-stack';

test('Lambda Functions Created', () => {
  const app = new cdk.App();
  const storageStack = new StorageStack(app, 'TestStorageStack');
  const ecsStack = new EcsStack(app, 'TestEcsStack', {
    artifactsBucket: storageStack.artifactsBucket,
    logsBucket: storageStack.logsBucket,
  });

  const stack = new BedrockAgentStack(app, 'TestBedrockStack', {
    buildStateTable: storageStack.buildStateTable,
    artifactsBucket: storageStack.artifactsBucket,
    logsBucket: storageStack.logsBucket,
    kbBucket: storageStack.kbBucket,
    ecsCluster: ecsStack.cluster,
    codeExecutorTaskDefinition: ecsStack.codeExecutorTaskDefinition,
  });

  const template = Template.fromStack(stack);

  // Verify 4 Lambda functions exist
  template.resourceCountIs('AWS::Lambda::Function', 4);

  // Verify IAM roles
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumedBy: {
      Service: 'bedrock.amazonaws.com',
    },
  });
});

test('Snapshot Test', () => {
  const app = new cdk.App();
  const storageStack = new StorageStack(app, 'TestStorageStack');
  const ecsStack = new EcsStack(app, 'TestEcsStack', {
    artifactsBucket: storageStack.artifactsBucket,
    logsBucket: storageStack.logsBucket,
  });

  const stack = new BedrockAgentStack(app, 'TestBedrockStack', {
    buildStateTable: storageStack.buildStateTable,
    artifactsBucket: storageStack.artifactsBucket,
    logsBucket: storageStack.logsBucket,
    kbBucket: storageStack.kbBucket,
    ecsCluster: ecsStack.cluster,
    codeExecutorTaskDefinition: ecsStack.codeExecutorTaskDefinition,
  });

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
