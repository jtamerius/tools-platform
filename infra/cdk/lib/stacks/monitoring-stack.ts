import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface MonitoringStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
  amplifyAppIds: string[];
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { cfg, amplifyAppIds } = props;
    const e = cfg.env;

    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `tools-alerts-${e}`,
      displayName: `Tools Platform Alerts (${e})`,
    });

    if (cfg.alertEmail) {
      alertTopic.addSubscription(new subs.EmailSubscription(cfg.alertEmail));
    }

    const billingAlarm = new cloudwatch.Alarm(this, 'BillingAlarm', {
      alarmName: `tools-monthly-billing-${e}`,
      alarmDescription: `Monthly AWS spend exceeded $${cfg.billingAlarmThresholdUSD}. Check Cost Explorer for unexpected charges.`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: cdk.Duration.hours(24),
      }),
      threshold: cfg.billingAlarmThresholdUSD,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    billingAlarm.addAlarmAction(new cwActions.SnsAction(alertTopic));
    billingAlarm.addOkAction(new cwActions.SnsAction(alertTopic));

    if (amplifyAppIds.length > 0) {
      const buildFailureRule = new events.Rule(this, 'AmplifyBuildFailureRule', {
        ruleName: `tools-amplify-build-failures-${e}`,
        description: 'Alert when an Amplify build fails or is cancelled',
        eventPattern: {
          source: ['aws.amplify'],
          detailType: ['Amplify Deployment Status Change'],
          detail: {
            appId: amplifyAppIds,
            jobStatus: ['FAILED', 'CANCELLED'],
          },
        },
      });

      buildFailureRule.addTarget(new eventsTargets.SnsTopic(alertTopic, {
        message: events.RuleTargetInput.fromText(
          'Amplify build ' +
          events.EventField.fromPath('$.detail.jobStatus') +
          ' on app ' +
          events.EventField.fromPath('$.detail.appId') +
          ' branch ' +
          events.EventField.fromPath('$.detail.branchName') +
          '. Check: https://console.aws.amazon.com/amplify/home',
        ),
      }));

      alertTopic.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowEventBridge',
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
      }));
    }

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      exportName: `tools-${e}-alert-topic-arn`,
    });

    new cdk.CfnOutput(this, 'BillingAlarmName', {
      value: billingAlarm.alarmName,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
