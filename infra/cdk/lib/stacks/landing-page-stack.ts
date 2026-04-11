import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';
import { CognitoStack } from './cognito-stack';

export interface LandingPageStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
  cognitoStack: CognitoStack;
}

export class LandingPageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LandingPageStackProps) {
    super(scope, id, props);
    const { cfg, cognitoStack } = props;
    const e = cfg.env;

    new ssm.StringParameter(this, 'LandingPageSSMUserPoolId', {
      parameterName: `/tools/${e}/cognito/user-pool-id`,
      stringValue: cognitoStack.userPool.userPoolId,
      description: `Cognito User Pool ID for the tools platform (${e})`,
    });

    new ssm.StringParameter(this, 'LandingPageSSMClientId', {
      parameterName: `/tools/${e}/cognito/client-id`,
      stringValue: cognitoStack.userPoolClient.userPoolClientId,
      description: `Cognito User Pool Client ID for the tools platform (${e})`,
    });

    new cdk.CfnOutput(this, 'SSMUserPoolIdPath', {
      value: `/tools/${e}/cognito/user-pool-id`,
      exportName: `tools-app-landing-page-${e}-SSMUserPoolIdPath`,
    });

    new cdk.CfnOutput(this, 'SSMClientIdPath', {
      value: `/tools/${e}/cognito/client-id`,
      exportName: `tools-app-landing-page-${e}-SSMClientIdPath`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
    cdk.Tags.of(this).add('App', 'landing-page');
  }
}
