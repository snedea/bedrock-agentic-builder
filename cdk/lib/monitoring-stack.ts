import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface MonitoringStackProps extends cdk.StackProps {
  buildStateTable: dynamodb.Table;
  scoutFunction: lambda.Function;
  architectFunction: lambda.Function;
  builderFunction: lambda.Function;
  testerFunction: lambda.Function;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'BuilderDashboard', {
      dashboardName: 'BedrockAgenticBuilder',
    });

    // Lambda metrics
    const functions = [
      { fn: props.scoutFunction, name: 'Scout' },
      { fn: props.architectFunction, name: 'Architect' },
      { fn: props.builderFunction, name: 'Builder' },
      { fn: props.testerFunction, name: 'Tester' },
    ];

    const invocationWidgets = functions.map(({ fn, name }) =>
      new cloudwatch.GraphWidget({
        title: `${name} Invocations`,
        left: [fn.metricInvocations()],
        width: 6,
      })
    );

    const errorWidgets = functions.map(({ fn, name }) =>
      new cloudwatch.GraphWidget({
        title: `${name} Errors`,
        left: [fn.metricErrors()],
        width: 6,
      })
    );

    const durationWidgets = functions.map(({ fn, name }) =>
      new cloudwatch.GraphWidget({
        title: `${name} Duration`,
        left: [fn.metricDuration()],
        width: 6,
      })
    );

    // Add widgets to dashboard
    dashboard.addWidgets(...invocationWidgets);
    dashboard.addWidgets(...errorWidgets);
    dashboard.addWidgets(...durationWidgets);

    // DynamoDB metrics
    const tableMetrics = new cloudwatch.GraphWidget({
      title: 'DynamoDB Operations',
      left: [
        props.buildStateTable.metricConsumedReadCapacityUnits(),
        props.buildStateTable.metricConsumedWriteCapacityUnits(),
      ],
      width: 12,
    });

    dashboard.addWidgets(tableMetrics);

    // Alarms for critical errors
    functions.forEach(({ fn, name }) => {
      new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        metric: fn.metricErrors({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 2,
        alarmName: `BedrockBuilder-${name}-Errors`,
        alarmDescription: `${name} Lambda function error rate exceeded threshold`,
      });

      new cloudwatch.Alarm(this, `${name}ThrottleAlarm`, {
        metric: fn.metricThrottles({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 10,
        evaluationPeriods: 2,
        alarmName: `BedrockBuilder-${name}-Throttles`,
        alarmDescription: `${name} Lambda function throttle rate exceeded threshold`,
      });
    });

    // Output
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });
  }
}
