import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface StepFunctionsStackProps extends cdk.StackProps {
  scoutFunction: lambda.Function;
  architectFunction: lambda.Function;
  builderFunction: lambda.Function;
  testerFunction: lambda.Function;
  deployerFunction: lambda.Function;
  buildStateTable: dynamodb.Table;
  artifactsBucket: s3.Bucket;
  logsBucket: s3.Bucket;
  kbBucket: s3.Bucket;
}

export class StepFunctionsStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly orchestratorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: StepFunctionsStackProps) {
    super(scope, id, props);

    // Shared Lambda layer (reuse from agent stack)
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/shared')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Shared libraries for Step Functions orchestration',
    });

    // Builder Orchestrator Lambda - Splits files for parallel execution
    this.orchestratorFunction = new lambda.Function(this, 'OrchestratorFunction', {
      functionName: 'bedrock-builder-orchestrator',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/orchestrator')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        BUILD_STATE_TABLE: props.buildStateTable.tableName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        LOGS_BUCKET: props.logsBucket.bucketName,
        KB_BUCKET: props.kbBucket.bucketName,
      },
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to orchestrator
    props.buildStateTable.grantReadWriteData(this.orchestratorFunction);
    props.artifactsBucket.grantReadWrite(this.orchestratorFunction);
    props.logsBucket.grantReadWrite(this.orchestratorFunction);
    props.kbBucket.grantReadWrite(this.orchestratorFunction);

    // Define Step Functions workflow
    // Step 1: Scout - Analyze requirements with caching
    const scoutTask = new tasks.LambdaInvoke(this, 'Scout', {
      lambdaFunction: props.scoutFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
        'task.$': '$.task',
        'mode.$': '$.mode',
      }),
      resultPath: '$.scout_result',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'body.$': '$.Payload.body',
      },
      retryOnServiceExceptions: true,
    });

    // Step 2: Architect - Design system architecture
    const architectTask = new tasks.LambdaInvoke(this, 'Architect', {
      lambdaFunction: props.architectFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
      }),
      resultPath: '$.architect_result',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'body.$': '$.Payload.body',
      },
      retryOnServiceExceptions: true,
    });

    // Step 3: Orchestrator - Split file structure into parallel tasks
    const orchestratorTask = new tasks.LambdaInvoke(this, 'PrepareParallelBuilders', {
      lambdaFunction: this.orchestratorFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
        'action': 'prepare_parallel_builds',
      }),
      resultPath: '$.build_tasks',
      resultSelector: {
        'tasks.$': '$.Payload.tasks',
        'total_files.$': '$.Payload.total_files',
      },
      retryOnServiceExceptions: true,
    });

    // Step 4: Parallel Map - Build files concurrently
    const builderTask = new tasks.LambdaInvoke(this, 'BuildSingleFile', {
      lambdaFunction: props.builderFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
        'file_path.$': '$.file_path',
        'specification.$': '$.specification',
        'language.$': '$.language',
        'parallel_mode': true,
      }),
      resultSelector: {
        'file_path.$': '$.Payload.file_path',
        'status.$': '$.Payload.status',
      },
      retryOnServiceExceptions: true,
    });

    const parallelBuilders = new sfn.Map(this, 'ParallelBuilders', {
      maxConcurrency: 6, // Build up to 6 files simultaneously
      itemsPath: '$.build_tasks.tasks',
      parameters: {
        'build_id.$': '$.build_id',
        'file_path.$': '$$.Map.Item.Value.file_path',
        'specification.$': '$$.Map.Item.Value.specification',
        'language.$': '$$.Map.Item.Value.language',
      },
      resultPath: '$.builder_results',
    });

    parallelBuilders.iterator(builderTask);

    // Step 5: Tester - Run tests and self-healing loop
    const testerTask = new tasks.LambdaInvoke(this, 'Tester', {
      lambdaFunction: props.testerFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
      }),
      resultPath: '$.tester_result',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'body.$': '$.Payload.body',
      },
      retryOnServiceExceptions: true,
    });

    // Step 6: Deployer - Deploy to GitHub if tests pass
    const deployerTask = new tasks.LambdaInvoke(this, 'Deployer', {
      lambdaFunction: props.deployerFunction,
      payload: sfn.TaskInput.fromObject({
        'build_id.$': '$.build_id',
        'test_result': 'PASSED',
      }),
      resultPath: '$.deployer_result',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'body.$': '$.Payload.body',
      },
      retryOnServiceExceptions: true,
    });

    // Check if Tester succeeded first, then check if tests passed
    const testsPassed = new sfn.Choice(this, 'TestsPassed?')
      .when(
        sfn.Condition.and(
          sfn.Condition.numberEquals('$.tester_result.statusCode', 200),
          sfn.Condition.booleanEquals('$.tester_result.body.tests_passed', true)
        ),
        deployerTask.next(new sfn.Succeed(this, 'BuildSucceeded', {
          comment: 'All tests passed - deployed to GitHub',
        }))
      )
      .when(
        sfn.Condition.numberEquals('$.tester_result.statusCode', 500),
        new sfn.Fail(this, 'TesterFailed', {
          error: 'TesterLambdaError',
          causePath: '$.tester_result.body.error',
        })
      )
      .otherwise(
        new sfn.Choice(this, 'MaxIterationsReached?')
          .when(
            sfn.Condition.numberGreaterThanEquals('$.tester_result.body.iteration', 3),
            new sfn.Fail(this, 'BuildFailed', {
              error: 'MaxIterationsReached',
              cause: 'Tests failed after maximum iterations (3)',
            })
          )
          .otherwise(
            // Self-healing: Loop back to Architect
            architectTask
          )
      );

    // Define workflow chain
    const definition = scoutTask
      .next(architectTask)
      .next(orchestratorTask)
      .next(parallelBuilders)
      .next(testerTask)
      .next(testsPassed);

    // Create CloudWatch log group for state machine
    const logGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      logGroupName: '/aws/stepfunctions/bedrock-builder',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create the state machine
    this.stateMachine = new sfn.StateMachine(this, 'BedrockBuilderStateMachine', {
      stateMachineName: 'bedrock-builder-workflow',
      definition: definition,
      timeout: cdk.Duration.hours(2),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    // Grant state machine permissions to invoke Lambdas
    props.scoutFunction.grantInvoke(this.stateMachine);
    props.architectFunction.grantInvoke(this.stateMachine);
    props.builderFunction.grantInvoke(this.stateMachine);
    props.testerFunction.grantInvoke(this.stateMachine);
    props.deployerFunction.grantInvoke(this.stateMachine);
    this.orchestratorFunction.grantInvoke(this.stateMachine);

    // Grant state machine read/write to DynamoDB and S3
    props.buildStateTable.grantReadWriteData(this.stateMachine);

    // Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Step Functions state machine ARN',
    });

    new cdk.CfnOutput(this, 'OrchestratorFunctionArn', {
      value: this.orchestratorFunction.functionArn,
      description: 'Orchestrator Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'StateMachineConsoleUrl', {
      value: `https://console.aws.amazon.com/states/home?region=${this.region}#/statemachines/view/${this.stateMachine.stateMachineArn}`,
      description: 'Step Functions console URL',
    });
  }
}
