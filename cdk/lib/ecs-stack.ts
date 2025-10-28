import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface EcsStackProps extends cdk.StackProps {
  artifactsBucket: s3.Bucket;
  logsBucket: s3.Bucket;
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly codeExecutorTaskDefinition: ecs.FargateTaskDefinition;
  public readonly ecrRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // VPC for Fargate tasks (optional - can use default VPC)
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'BuilderCluster', {
      clusterName: 'bedrock-builder-cluster',
      vpc,
      containerInsights: true,
    });

    // ECR repository for executor Docker image
    this.ecrRepository = new ecr.Repository(this, 'ExecutorRepository', {
      repositoryName: 'bedrock-code-executor',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // Task execution role (for pulling images, writing logs)
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task role (for application code to access AWS services)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant S3 access to task role
    props.artifactsBucket.grantReadWrite(taskRole);
    props.logsBucket.grantWrite(taskRole);

    // Grant Secrets Manager access for GitHub tokens
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
      ],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-builder/*`,
      ],
    }));

    // CloudWatch log group for task logs
    const logGroup = new logs.LogGroup(this, 'TaskLogGroup', {
      logGroupName: '/ecs/bedrock-builder/code-executor',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Fargate task definition
    this.codeExecutorTaskDefinition = new ecs.FargateTaskDefinition(this, 'CodeExecutorTask', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
    });

    // Container definition (will be built from docker/executor/)
    this.codeExecutorTaskDefinition.addContainer('ExecutorContainer', {
      containerName: 'code-executor',
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, 'latest'),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'executor',
        logGroup,
      }),
      environment: {
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        LOGS_BUCKET: props.logsBucket.bucketName,
        AWS_REGION: this.region,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name',
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: this.codeExecutorTaskDefinition.taskDefinitionArn,
      description: 'Fargate task definition ARN',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: this.ecrRepository.repositoryUri,
      description: 'ECR repository URI for executor image',
    });
  }
}
